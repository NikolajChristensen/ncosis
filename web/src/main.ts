import { mount } from 'svelte'
import { registerSW } from 'virtual:pwa-register'
import './app.css'
import App from './App.svelte'

// Reload once when a new version has been deployed, instead of showing the cached one.
registerSW({ immediate: true })

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
