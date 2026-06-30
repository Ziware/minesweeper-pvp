import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import { ProfilePage } from './pages/ProfilePage/ProfilePage';
import './index.css';

function RouterApp() {
  return (
    <Routes>
      <Route path="/profile/:login" element={<ProfilePage />} />
      <Route path="/*" element={<App />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouterApp />
    </BrowserRouter>
  </React.StrictMode>
);
