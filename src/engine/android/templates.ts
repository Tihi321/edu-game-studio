/** Text files of the generated Android project (EGS-19). No personal paths, no secrets: the keystore is the user's own. */

export const CAPACITOR_VERSION = '^8.5.3'

export interface ProjectInfo {
  slug: string
  title: string
  appId: string
}

export function packageJson(i: ProjectInfo): string {
  return (
    JSON.stringify(
      {
        name: `edu-${i.slug}-android`,
        version: '1.0.0',
        private: true,
        description: `${i.title}: the Edu Studio course "${i.slug}" as an Android app (Capacitor)`,
        scripts: {
          'android:sync': 'npx cap sync android',
          'android:apk': 'npm run android:sync && node scripts/gradle.mjs assembleRelease',
          'android:bundle': 'npm run android:sync && node scripts/gradle.mjs bundleRelease',
          'android:run': 'npm run android:sync && npx cap run android'
        },
        dependencies: { '@capacitor/android': CAPACITOR_VERSION, '@capacitor/core': CAPACITOR_VERSION },
        devDependencies: { '@capacitor/cli': CAPACITOR_VERSION }
      },
      null,
      2
    ) + '\n'
  )
}

export function capacitorConfig(i: ProjectInfo): string {
  return JSON.stringify({ appId: i.appId, appName: i.title, webDir: 'www' }, null, 2) + '\n'
}

export const GITIGNORE = [
  'node_modules/',
  'android/build/',
  'android/app/build/',
  'android/.gradle/',
  'android/local.properties',
  'android/keystore.properties',
  '*.jks',
  '*.keystore',
  '*.apk',
  '*.aab',
  ''
].join('\n')

export const KEYSTORE_EXAMPLE = `# Copy to android/keystore.properties (git-ignored) and fill in YOUR key. Edu Studio never makes or stores a keystore.
# storeFile is resolved relative to android/app/ (absolute paths also work).
storeFile=../../release-keys/my-upload-key.jks
storePassword=CHANGE_ME
keyAlias=my-upload-key
keyPassword=CHANGE_ME
`

/** scripts/gradle.mjs of the generated project: finds the JDK and the Android SDK, then runs the Gradle wrapper in android/. (No backticks or dollar-braces in it: it is a raw string.) */
export const GRADLE_SCRIPT = String.raw`// Runs the Gradle wrapper in android/ on any OS: node scripts/gradle.mjs assembleRelease
// Finds the JDK (JAVA_HOME, else java on PATH, else the usual install folders) and the Android SDK
// (ANDROID_HOME, ANDROID_SDK_ROOT, else the default folders). Nothing here is specific to one machine.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const win = process.platform === 'win32'
const cwd = fileURLToPath(new URL('../android/', import.meta.url))
if (!existsSync(cwd)) {
  console.error('There is no android/ folder yet: run "npx cap add android" first (see README.md).')
  process.exit(1)
}

function firstChild(dir, test) {
  try {
    return readdirSync(dir).filter(test).sort().reverse().map((n) => join(dir, n))[0]
  } catch {
    return undefined
  }
}

function findJdk() {
  const javaBin = win ? 'java.exe' : 'java'
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', javaBin))) return process.env.JAVA_HOME
  const roots = win
    ? ['C:\\Program Files\\Android\\Android Studio\\jbr', ...['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu'].map((v) => join('C:\\Program Files', v))]
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', '/Applications/Android Studio.app/Contents/jbr']
  for (const r of roots) {
    if (existsSync(join(r, 'bin', javaBin))) return r
    const sub = firstChild(r, (n) => /jdk|jbr|temurin|zulu/i.test(n))
    if (sub && existsSync(join(sub, 'bin', javaBin))) return sub
    if (sub && existsSync(join(sub, 'Contents', 'Home', 'bin', javaBin))) return join(sub, 'Contents', 'Home')
  }
  return undefined
}

function findSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]
  if (win) candidates.push(join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk'))
  else candidates.push(join(homedir(), 'Android', 'Sdk'), join(homedir(), 'Library', 'Android', 'sdk'))
  return candidates.find((c) => c && existsSync(c))
}

const env = { ...process.env }
const jdk = findJdk()
if (jdk) {
  env.JAVA_HOME = jdk
  env.PATH = join(jdk, 'bin') + (win ? ';' : ':') + (env.PATH || '')
} else if (spawnSync('java', ['-version'], { stdio: 'ignore', shell: win }).status !== 0) {
  console.error('No JDK found. Install JDK 17 or newer and set JAVA_HOME (Android Studio ships one).')
  process.exit(1)
}
const sdk = findSdk()
if (!sdk) {
  console.error('No Android SDK found. Install Android Studio or the command-line tools and set ANDROID_HOME.')
  process.exit(1)
}
env.ANDROID_HOME = sdk
env.ANDROID_SDK_ROOT = sdk
// Gradle reads the SDK folder from android/local.properties; written when it is missing, and it is git-ignored.
const local = join(cwd, 'local.properties')
if (!existsSync(local)) writeFileSync(local, 'sdk.dir=' + sdk.replace(/\\/g, '/') + '\n')

// Absolute path: cmd.exe may not search the cwd (NoDefaultCurrentDirectoryInExePath).
const wrapper = win ? '"' + join(cwd, 'gradlew.bat') + '"' : './gradlew'
const r = spawnSync(wrapper, process.argv.slice(2), { cwd, env, stdio: 'inherit', shell: win })
process.exit(r.status ?? 1)
`

export function readme(i: ProjectInfo): string {
  return `# ${i.title}: Android app

Generated by Edu Studio (\`edu_android_prepare\`, EGS-19) from the built course \`${i.slug}\`. This folder is a Capacitor project: \`www/\` is the game
(the course's \`build/\` folder), \`capacitor.config.json\` names the app (\`${i.appId}\`). The native \`android/\` project is made by Capacitor on
the first run and is never touched when Edu Studio refreshes this folder.

## You need

- Node 20 or newer and npm.
- A JDK 17 or newer (\`JAVA_HOME\`; Android Studio ships one) and the Android SDK (\`ANDROID_HOME\`, usually installed with Android Studio).

## Steps

\`\`\`
npm install
npx cap add android        # once: creates android/
npm run android:sync       # copies www/ into the native project
npm run android:run        # a connected device or an emulator
npm run android:apk        # android/app/build/outputs/apk/release (needs signing, below)
npm run android:bundle     # android/app/build/outputs/bundle/release (.aab for the Play Store)
\`\`\`

Rebuild the course in Edu Studio and run \`edu_android_prepare\` again (or \`node scripts/android.mjs ${i.slug}\` in the Edu Studio repo): \`www/\`
and the config are refreshed; \`android/\`, \`node_modules/\` and your keystore stay.

## Icon and splash

\`resources/icon.png\` and \`resources/splash.png\` are made from the course cover (or a generated picture). To put them into the app:
\`npx @capacitor/assets generate --android\` (an extra download, run when you want it).

## Signing (your key, not ours)

A release APK or bundle must be signed with a key only you hold. Make one with \`keytool\` (the JDK), keep it out of git, then:

1. Copy \`keystore.properties.example\` to \`android/keystore.properties\` and fill in your values (git-ignored).
2. In \`android/app/build.gradle\` read that file in a \`signingConfigs.release\` block and set \`signingConfig\` in \`buildTypes.release\`
   (the Capacitor template has none; the Android documentation shows the block).
3. \`npm run android:apk\` or \`npm run android:bundle\`.

Edu Studio never generates, stores or commits a keystore. \`android:run\` installs a debug build without one.
`
}
