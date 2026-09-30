import { AuthGate } from '../features/auth/AuthGate';
import { LabelReader } from '../features/label-reader/LabelReader';
import { getRuntimeConfig } from '../lib/runtime';

export function App() {
  const config = getRuntimeConfig();
  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">
          LEITURA DE ETIQUETAS · {config ? 'OPERACIONAL' : 'PILOTO'}
        </p>
        <h1 id="page-title">Paper Stock Control</h1>
        <p className="subtitle">
          Passe a câmera pelas áreas de uma etiqueta Impress, Schattdecor ou Interprint.
          O aplicativo coleta cada campo e avisa o que ainda falta.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          {config ? 'Modo operacional conectado' : 'O vídeo não é gravado; somente evidências aprovadas'}
        </div>
      </section>

      {config ? (
        <AuthGate config={config} pilot={<LabelReader />}>
          {(accessToken, signOut) => (
            <>
              <div className="session-bar">
                <span>Sessão autenticada · fotos serão guardadas no Storage privado</span>
                <button type="button" onClick={() => void signOut()}>Sair</button>
              </div>
              <LabelReader persistence={{ config, accessToken }} />
            </>
          )}
        </AuthGate>
      ) : (
        <LabelReader />
      )}

      <footer>
        {config ? (
          <><strong>Modo real:</strong> confirme somente depois de revisar material, lote, quantidade e destino.</>
        ) : (
          <><strong>Teste seguro:</strong> aprovar a leitura não cria pallet nem altera o estoque.</>
        )}
      </footer>
    </main>
  );
}
