import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import * as separation from './lib/separation'

separation.start()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
