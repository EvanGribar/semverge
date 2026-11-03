import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import SemvergeContext from './index'

function Scene() {
  useEffect(() => {
    document.querySelector('.product-scene')?.classList.add('stage-enhanced')
  }, [])
  return <SemvergeContext />
}

const mount = document.getElementById('context-stage')
if (mount) createRoot(mount).render(<Scene />)
