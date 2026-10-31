import './live.css'
import { startHost } from './host'
import { startPlayer } from './player'

/** The entry of the live quiz bundle (`out/live/live.js`, one IIFE): the host page under /live/host/<token>/, else the player page. */
const root = document.getElementById('live-root')
if (root) {
  const host = /^\/live\/host\/([A-Za-z0-9]+)\/?$/.exec(window.location.pathname)
  if (host?.[1]) startHost(root, host[1])
  else void startPlayer(root)
}
