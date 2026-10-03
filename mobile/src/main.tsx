import React from 'react';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import '../../src/app/globals.css';
import './style.css';

const apiOrigin = (import.meta.env.VITE_AGENTPROOF_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
createRoot(document.getElementById('root')!).render(<React.StrictMode><MobileApp apiOrigin={apiOrigin} /></React.StrictMode>);
