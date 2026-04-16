import { Suspense, lazy, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { rememberWorkspaceVisit } from './lib/workspaceHistory'
import { LaunchPage } from './pages/LaunchPage'
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
        <p>작업 화면을 불러오는 중입니다...</p>
      </section>
    </div>
  )
}

function WorkspaceHistorySync() {
  const location = useLocation()

  useEffect(() => {
    rememberWorkspaceVisit(location.pathname)
  }, [location.pathname])

  return null
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <WorkspaceHistorySync />
      <Routes>
        <Route path="/" element={<LaunchPage />} />
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
