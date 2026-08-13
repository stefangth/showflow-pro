import type { PostHogRollupPluginOptions } from '@posthog/rollup-plugin';

type BuildEnv = Record<string, string | undefined>;

/**
 * Returns private source-map upload settings only for fully configured
 * production builds. Client-visible VITE_ variables are deliberately ignored.
 */
export function readPostHogSourceMapOptions(
  mode: string,
  env: BuildEnv,
): PostHogRollupPluginOptions | null {
  const personalApiKey = env.POSTHOG_API_KEY?.trim();
  const projectId = env.POSTHOG_PROJECT_ID?.trim();
  const host = env.POSTHOG_HOST?.trim();
  const releaseVersion = env.VERCEL_GIT_COMMIT_SHA?.trim() || env.npm_package_version?.trim();

  if (mode !== 'production' || !personalApiKey || !projectId || !host || !releaseVersion) return null;

  return {
    personalApiKey,
    projectId,
    host,
    sourcemaps: {
      enabled: true,
      releaseName: 'showflow-pro',
      releaseVersion,
      deleteAfterUpload: true,
    },
  };
}
