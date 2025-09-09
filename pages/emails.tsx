import React, { useState } from 'react';

const EmailsPage = () => {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch('/api/email/promote/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      setResult(data);
    } catch (err) {
      if (err instanceof Error) {
        setResult({ error: err.message });
      } else {
        setResult({ error: String(err) });
      }
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '1rem' }}>
      <h1>Emails</h1>
      <button onClick={handleClick} disabled={loading}>
        {loading ? 'Cargando...' : 'Leer emails'}
      </button>
      {result && (
        <pre style={{ marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
};

export default EmailsPage;
