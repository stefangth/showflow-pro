import { describe, expect, it } from 'vitest';
import { readPostHogSourceMapOptions } from './posthogSourceMaps';

const completeEnv = {
  POSTHOG_API_KEY: 'phx_secret',
  POSTHOG_PROJECT_ID: '246246',
  POSTHOG_HOST: 'https://eu.posthog.com',
  VERCEL_GIT_COMMIT_SHA: 'commit-sha',
  npm_package_version: '1.16.0',
  VITE_POSTHOG_KEY: 'phc_public',
};

describe('readPostHogSourceMapOptions', () => {
  it('skips local and incomplete production builds', () => {
    expect(readPostHogSourceMapOptions('development', completeEnv)).toBeNull();
    expect(readPostHogSourceMapOptions('production', { ...completeEnv, POSTHOG_API_KEY: '' })).toBeNull();
  });

  it('creates a private production upload configuration', () => {
    const options = readPostHogSourceMapOptions('production', completeEnv);

    expect(options).toEqual({
      personalApiKey: 'phx_secret',
      projectId: '246246',
      host: 'https://eu.posthog.com',
      sourcemaps: {
        enabled: true,
        releaseName: 'showflow-pro',
        releaseVersion: 'commit-sha',
        deleteAfterUpload: true,
      },
    });
    expect(JSON.stringify(options)).not.toContain('phc_public');
  });
});
