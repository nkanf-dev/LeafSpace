import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'

// 暴露 Store 到 window，仅用于测试
import { bookStore } from './stores/bookStore'
import { heldStore } from './stores/heldStore'
import { windowStore } from './stores/windowStore'

if (import.meta.env.MODE === 'development' || (window as any).PLAYWRIGHT_TEST) {
  (window as any).bookStore = bookStore;
  (window as any).heldStore = heldStore;
  (window as any).windowStore = windowStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
