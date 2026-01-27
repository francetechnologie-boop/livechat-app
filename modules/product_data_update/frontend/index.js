import React from 'react';

// Lazy-load the main page to avoid executing hooks during module discovery.
const LazyMain = React.lazy(() => import('./pages/Main.jsx'));

class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null, info: null }; }
  static getDerivedStateFromError(err) { return { hasError: true, error: err }; }
  componentDidCatch(err, info) { try { console.error('[product_data_update] boundary', err, info); } catch {}; this.setState({ info }); }
  render() {
    if (this.state.hasError) {
      const box = {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif',
        color: '#1f2937', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12, margin: 12
      };
      const pre = { whiteSpace: 'pre-wrap', fontSize: 12, color: '#b91c1c', background: '#fff7ed', border: '1px solid #fecaca', padding: 8, borderRadius: 4 };
      return React.createElement('div', { style: box },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 6 } }, 'Product Data Update — render error'),
        React.createElement('div', { style: { fontSize: 12, marginBottom: 6 } }, 'Please reload the page. If it persists, check the browser console for details.'),
        React.createElement('pre', { style: pre }, String(this.state.error && (this.state.error.message || this.state.error)))
      );
    }
    return this.props.children;
  }
}

export default function ModuleEntry() {
  const fallback = React.createElement('div', { style: { padding: 12, fontSize: 12, color: '#6b7280' } }, 'Loading Product Data Update…');
  return React.createElement(Boundary, null,
    React.createElement(React.Suspense, { fallback },
      React.createElement(LazyMain)
    )
  );
}
