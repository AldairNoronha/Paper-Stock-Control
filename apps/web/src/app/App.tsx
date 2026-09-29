import { LabelReader } from '../features/label-reader/LabelReader';

export function App() {
  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">LEITURA DE ETIQUETAS · PILOTO</p>
        <h1 id="page-title">Paper Stock Control</h1>
        <p className="subtitle">
          Fotografe uma etiqueta Impress, Schattdecor ou Interprint e revise os dados
          identificados pelo aparelho.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          A foto não sai do aparelho neste teste
        </div>
      </section>

      <LabelReader />

      <footer>
        <strong>Teste seguro:</strong> aprovar a leitura não cria pallet nem altera o estoque.
      </footer>
    </main>
  );
}
