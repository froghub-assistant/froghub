import { mount } from 'svelte'
import './admin.css'
import Admin from './Admin.svelte'

export default mount(Admin, { target: document.getElementById('app') })
