'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: '#f8f6f1', color: '#28241f', fontFamily: 'Arial, "PingFang SC", sans-serif' }}>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <section
            role="alert"
            style={{ maxWidth: 440, border: '1px solid #e7e2d8', borderRadius: 12, background: '#fff', padding: 28 }}
          >
            <p style={{ margin: 0, fontSize: 11, color: '#b4532a', fontWeight: 700, letterSpacing: '0.08em' }}>
              SNACKOPS
            </p>
            <h1 style={{ margin: '10px 0 8px', fontSize: 20 }}>工作区暂时无法加载</h1>
            <p style={{ margin: 0, color: '#756f64', fontSize: 13, lineHeight: 1.7 }}>
              应用级错误已阻断当前页面。请重试；若问题持续，请检查服务端日志与数据文件。
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: 18,
                border: 0,
                borderRadius: 8,
                background: '#b4532a',
                color: '#fff',
                padding: '9px 16px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
