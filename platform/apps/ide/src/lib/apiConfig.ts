/**
 * Centralized API Configuration
 *
 * Single source of truth for all API and WebSocket URLs.
 * All modules should import from here instead of hardcoding localhost URLs.
 */

const API_BASE_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:8000';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8012';
const AI_SERVICE_URL = import.meta.env.VITE_AI_SERVICE_URL || 'http://localhost:8003';
const EXECUTION_SERVICE_URL = import.meta.env.VITE_EXECUTION_SERVICE_URL || 'http://localhost:8004';
const PYTHON_AGENTS_URL = import.meta.env.VITE_PYTHON_AGENTS_URL || 'http://localhost:9000';

export const apiConfig = {
  baseUrl: API_BASE_URL,
  wsUrl: WS_URL,
  aiServiceUrl: AI_SERVICE_URL,
  executionServiceUrl: EXECUTION_SERVICE_URL,
  pythonAgentsUrl: PYTHON_AGENTS_URL,

  /** Build a full API URL from a path */
  url(path: string): string {
    return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  },

  /** Build a full WS URL from a path */
  ws(path: string = ''): string {
    return `${WS_URL}${path.startsWith('/') ? path : `/${path}`}`;
  },
};
