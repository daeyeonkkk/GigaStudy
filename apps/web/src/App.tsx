import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import './App.css'

const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const LaunchPage = lazy(() => import('./pages/LaunchPage').then((module) => ({ default: module.LaunchPage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })))
const StudioPage = lazy(() => import('./pages/StudioPage').then((module) => ({ default: module.StudioPage })))

function RouteFallback() {
  return (
    <main className="app-shell route-fallback" aria-label="Loading page">
      <div className="route-fallback__meter" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <p className="eyebrow">GigaStudy</p>
        <h1>화면을 불러오는 중입니다</h1>
      </div>
    </main>
  )
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LaunchPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/studios/:studioId" element={<StudioPage />} />
        <Route path="/studios/:studioId/reports/:reportId" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
