import { createContext, useContext, useEffect, useState } from 'react';

export interface ConsentChoices {
  analytics: boolean;
  sessionReplay: boolean;
  errorTracking: boolean;
}

interface ConsentState {
  hasDecided: boolean;
  consent: ConsentChoices;
  acceptAll: () => void;
  rejectAll: () => void;
  setConsent: (choices: ConsentChoices) => void;
  openPreferences: () => void;
  closePreferences: () => void;
  preferencesOpen: boolean;
}

const STORAGE_KEY = 'showflow.consent.v1';

export interface StoredConsent {
  version: 1;
  hasDecided: boolean;
  choices: ConsentChoices;
}

export function readStoredConsent(): StoredConsent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsent;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(hasDecided: boolean, choices: ConsentChoices) {
  const value: StoredConsent = { version: 1, hasDecided, choices };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

const ALL_ON: ConsentChoices = { analytics: true, sessionReplay: true, errorTracking: true };
const ALL_OFF: ConsentChoices = { analytics: false, sessionReplay: false, errorTracking: false };

const ConsentContext = createContext<ConsentState | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const stored = readStoredConsent();
  const [hasDecided, setHasDecided] = useState(stored?.hasDecided ?? false);
  const [consent, setConsentState] = useState<ConsentChoices>(stored?.choices ?? ALL_OFF);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    persist(hasDecided, consent);
  }, [hasDecided, consent]);

  const acceptAll = () => {
    setConsentState(ALL_ON);
    setHasDecided(true);
  };

  const rejectAll = () => {
    setConsentState(ALL_OFF);
    setHasDecided(true);
  };

  const setConsent = (choices: ConsentChoices) => {
    setConsentState(choices);
    setHasDecided(true);
  };

  return (
    <ConsentContext.Provider value={{
      hasDecided,
      consent,
      acceptAll,
      rejectAll,
      setConsent,
      preferencesOpen,
      openPreferences: () => setPreferencesOpen(true),
      closePreferences: () => setPreferencesOpen(false),
    }}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent(): ConsentState {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used within ConsentProvider');
  return ctx;
}
