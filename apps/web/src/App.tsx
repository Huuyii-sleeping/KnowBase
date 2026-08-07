function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">KNOWBASE / PHASE 1</p>
        <h1>文档模块基础工程已就绪</h1>
        <p className="summary">
          下一步将围绕文档上传、审核生命周期和 PostgreSQL + MongoDB 分层存储建设业务页面。
        </p>
      </section>

      <section className="status-grid" aria-label="系统模块状态">
        <StatusItem title="前端" detail="React + Vite" />
        <StatusItem title="后端" detail="NestJS" />
        <StatusItem title="元数据" detail="PostgreSQL" />
        <StatusItem title="正文" detail="MongoDB" />
        <StatusItem title="原始文件" detail="RustFS" />
      </section>
    </main>
  );
}

function StatusItem({ title, detail }: { title: string; detail: string }) {
  return (
    <article className="status-item">
      <span className="status-dot" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

export default App;
