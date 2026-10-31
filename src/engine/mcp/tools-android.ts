import path from 'node:path'
import { z } from 'zod'
import { prepareAndroid } from '../android/generate'
import { syncAndroid } from '../android/sync'
import { coursesDir } from '../edu/paths'
import type { EduService } from '../edu/service'
import type { Tool, ToolDef } from './tools'

/** The Android tool (EGS-19): wraps a built course into a Capacitor project folder. See docs/android.md. */

export function androidTools(svc: EduService, def: ToolDef): Tool[] {
  return [
    def(
      'edu_android_prepare',
      'Wrap the BUILT course into an Android app project: courses/<slug>/android/ with package.json, capacitor.config.json (appId org.edustudio.<slug> unless given), www/ (a copy of the build), scripts/gradle.mjs, icon and splash pictures, README.md (the steps and how YOU sign a release) and .gitignore. Run again after a rebuild: www/ and the config refresh, the native android/ folder, node_modules and keystores are left alone. sync: true also runs npm install and npx cap add/sync android there (downloads Capacitor; long). It builds no APK and makes no keystore.',
      z.object({
        slug: z.string().describe('The course slug (see edu_list_courses); the course must be built (edu_build)'),
        appId: z.string().optional().describe('An Android application id, for example org.example.myapp (default org.edustudio.<slug>)'),
        sync: z.boolean().optional().describe('Also run npm install and npx cap add android (first time) or cap sync android; default false')
      }),
      async (a) => {
        if (!(await svc.courseExists(a.slug))) throw new Error(`unknown course "${a.slug}"`)
        const r = await prepareAndroid(path.join(coursesDir(svc.dataDir), a.slug), { slug: a.slug, appId: a.appId })
        const out: Record<string, unknown> = { ...r, next: a.sync ? undefined : `cd ${r.dir} and follow README.md (npm install, npx cap add android, npm run android:apk)` }
        if (a.sync) {
          const steps = await syncAndroid(r.dir)
          out.sync = steps
          out.synced = steps.length > 0 && steps.every((s) => s.ok) && steps.some((s) => s.step.startsWith('npx cap'))
        }
        return out
      }
    )
  ]
}
