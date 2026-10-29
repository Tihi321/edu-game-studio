import { useEffect, useState } from 'react'
import { getStartWithWindows, sendCommand, setStartWithWindows } from '../api'
import { useEdu } from '../store/hooks'
import { McpSettings } from './McpSettings'

export function SettingsPage() {
  const secretsSet = useEdu((s) => s.secretsSet)
  /** The key variables the engine reports (`api_key_env` of every provider, custom ones too). It refuses names that are not in providers.md. */
  const keyNames = useEdu((s) => s.keyNames)
  const dataDir = useEdu((s) => s.dataDir)
  const [picked, setKeyName] = useState('')
  const [keyValue, setKeyValue] = useState('')
  const [login, setLogin] = useState<boolean | null>(null)

  useEffect(() => {
    void getStartWithWindows().then(setLogin)
  }, [])
  const names = [...new Set([...keyNames, ...secretsSet])]
  const keyName = names.includes(picked) ? picked : (names[0] ?? '')
  const keySet = secretsSet.includes(keyName)
  return (
    <div className="stack" style={{ maxWidth: 640 }} data-testid="page-settings">
      <div className="panel-title">Settings</div>
      <label>Edu Studio data folder</label>
      <input value={dataDir} readOnly data-testid="set-dataDir" />
      <div className="dim">Set with --data or the EDU_DATA environment variable. The default is ~/EduGames. Restart to change it.</div>
      <hr />
      <McpSettings />
      <hr />
      <div className="dim">Provider API key (stored in the Windows credential store, never in a file)</div>
      <select value={keyName} onChange={(e) => setKeyName(e.target.value)} data-testid="set-key-name">
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
            {secretsSet.includes(n) ? ' (set)' : ''}
          </option>
        ))}
      </select>
      <div className="row">
        <input
          type="password"
          autoComplete="off"
          style={{ flex: 1 }}
          value={keyValue}
          placeholder={keySet ? 'Key is set. Type to replace' : 'Paste the key'}
          onChange={(e) => setKeyValue(e.target.value)}
          data-testid="set-key-value"
        />
        <button
          disabled={!keyValue || !keyName}
          data-testid="set-key-save"
          onClick={() => {
            sendCommand({ type: 'setSecret', name: keyName, value: keyValue })
            setKeyValue('')
          }}
        >
          Store key
        </button>
      </div>
      <hr />
      <label className="row">
        <input type="checkbox" style={{ width: 'auto' }} checked={login === true} disabled={login === null} data-testid="set-login" onChange={(e) => void setStartWithWindows(e.target.checked).then(setLogin)} />
        Start Edu Studio with Windows{login === null ? ' (only in the desktop app)' : ''}
      </label>
    </div>
  )
}
