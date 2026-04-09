import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { HomePage } from './pages/HomePage'
import './App.css'

const ArrangementPage = lazy(() =>
  import('./pages/ArrangementPage').then((module) => ({
    default: module.ArrangementPage,
  })),
)
const OpsPage = lazy(() =>
  import('./pages/OpsPage').then((module) => ({
    default: module.OpsPage,
  })),
)
const SharedProjectPage = lazy(() =>
  import('./pages/SharedProjectPage').then((module) => ({
    default: module.SharedProjectPage,
  })),
)
const StudioPage = lazy(() =>
  import('./pages/StudioPage').then((module) => ({
    default: module.StudioPage,
  })),
)

function RouteFallback() {
  return (
    <div className="page-shell">
      <section className="panel">
        <p>Loading the workspace...</p>
      </section>
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/projects/:projectId/studio" element={<StudioPage />} />
        <Route path="/projects/:projectId/arrangement" element={<ArrangementPage />} />
        <Route path="/shared/:shareToken" element={<SharedProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
