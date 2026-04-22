import { Navigate, Route, Routes } from 'react-router-dom'

import { AdminPage } from './pages/AdminPage'
import { LaunchPage } from './pages/LaunchPage'
import { ReportPage } from './pages/ReportPage'
import { StudioPage } from './pages/StudioPage'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LaunchPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/studios/:studioId" element={<StudioPage />} />
      <Route path="/studios/:studioId/reports/:reportId" element={<ReportPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
