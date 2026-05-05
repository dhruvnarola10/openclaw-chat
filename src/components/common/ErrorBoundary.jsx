// Catches render-time errors anywhere in the app so a single bug doesn't
// blank the whole UI. Shows the error inline with a Retry button.

import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface for dev visibility; don't swallow silently.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <div className="error-boundary-icon"><AlertTriangle size={32} /></div>
          <h2>Something broke while rendering this page</h2>
          <p>{this.props.message ?? 'A React component threw an exception. The rest of the app is still alive.'}</p>
          <pre className="error-boundary-pre">{String(error?.message ?? error)}</pre>
          <div className="error-boundary-actions">
            <button className="ov-btn ov-btn--primary" onClick={this.reset}>
              Try again
            </button>
            <button className="ov-btn" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
