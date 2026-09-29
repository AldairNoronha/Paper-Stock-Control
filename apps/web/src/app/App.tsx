const foundationItems = [
  'Recebimento manual controlado',
  'Rastreabilidade por pallet',
  'Movimentações e estornos auditáveis',
  'Rotação FIFO e FEFO'
];

export function App() {
  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">FASES 1 E 2 CONCLUÍDAS</p>
        <h1 id="page-title">Paper Stock Control</h1>
        <p className="subtitle">
          Controle operacional e rastreabilidade de papel melamínico.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          Núcleo transacional pronto para integração
        </div>
      </section>

      <section className="foundation" aria-labelledby="foundation-title">
        <h2 id="foundation-title">Escopo do produto</h2>
        <ul>
          {foundationItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
