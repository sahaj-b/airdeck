import { createRoot } from 'react-dom/client';
import './dashboard.css';

function DashboardPlaceholder() {
  return (
    <main className="dashboard-placeholder">
      <h1>Airdeck dashboard</h1>
      <p>The host dashboard is not installed in this build.</p>
    </main>
  );
}

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('dashboard root is missing');
createRoot(root).render(<DashboardPlaceholder />);
