# showflow-pro.landingpage

Standalone landing page for [Showflow Pro](https://showflow.pro), deployed separately from the main application.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS (design tokens match the main app)
- framer-motion for animations
- lucide-react for icons

## Setup

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Deployment

Deploy to Vercel. Point the project root to this repository.
The `vercel.json` at the root handles SPA rewrites.

Target domain: **showflow.pro**

The main app lives at **app.showflow.pro**.

## Migrating this code into its own repo

This folder was included in the `showflow-pro` PR for review. To push it to the new repo:

```bash
# From the root of showflow-pro, after checking out the PR branch:
cp -r landingpage /tmp/showflow-pro-landingpage
cd /tmp/showflow-pro-landingpage
git init
git branch -m main
git add .
git commit -m "init: standalone landing page project"
git remote add origin https://github.com/stefangth/showflow-pro.landingpage.git
git push -u origin main --force
```
