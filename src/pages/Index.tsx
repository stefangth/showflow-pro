import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { APP_META, ROUTES } from '@/config/app.config';
import { Zap, CalendarDays, Users, BookOpen, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  { icon: CalendarDays, title: 'Show Management', desc: 'Create and manage shows with dates, venues, and slot configurations.' },
  { icon: Users, title: 'Artist Roster', desc: 'Centralized artist database with skills, availability, and priority scoring.' },
  { icon: BookOpen, title: 'Smart Booking', desc: 'Auto-suggest optimal assignments with soft-book → confirm workflow.' },
  { icon: Sparkles, title: 'Understudy Coverage', desc: 'Assign backups per date with automatic promotion on cancellation.' },
];

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">{APP_META.NAME}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to={ROUTES.LOGIN}>
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link to={ROUTES.SIGNUP}>
            <Button>Get Started</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-20 pb-32 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" />
            Built for live show productions
          </div>
          <h1 className="font-display text-5xl md:text-7xl font-bold leading-tight max-w-4xl mx-auto">
            Book artists.
            <br />
            <span className="text-primary">Fill every show.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mt-6">
            {APP_META.NAME} replaces spreadsheets and email chains with intelligent booking automation.
            Auto-suggest artists, manage availability, and track every assignment in real time.
          </p>
          <div className="flex items-center justify-center gap-4 mt-10">
            <Link to={ROUTES.SIGNUP}>
              <Button size="lg" className="text-base px-8 h-12">
                Start Booking <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link to={ROUTES.LOGIN}>
              <Button size="lg" variant="outline" className="text-base px-8 h-12">Sign In</Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 pb-32">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }}
              className="bg-card border border-border rounded-2xl p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center">
        <p className="text-sm text-muted-foreground">&copy; {new Date().getFullYear()} {APP_META.NAME}. Intelligent booking for live show productions.</p>
      </footer>
    </div>
  );
}
