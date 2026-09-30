import { AuthGate } from '../features/auth/AuthGate';
import { ReaderWorkspace } from '../features/photo-reader/ReaderWorkspace';
import { getRuntimeConfig } from '../lib/runtime';
import { AppUpdate } from './AppUpdate';

export function App() {
  const config = getRuntimeConfig();
  return (
    <main className="app-shell">
      <AppUpdate />
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">
          LEITURA DE ETIQUETAS · {config ? 'OPERACIONAL' : 'PILOTO'}
        </p>
        <h1 id="page-title">Paper Stock Control</h1>
        <p className="subtitle">
          Fotografe a etiqueta completa de Impress, Schattdecor ou Interprint.
          Na V2, o servidor extrai o texto e você confere cada campo na imagem.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" />
          V2 em validação · análise não movimenta estoque
        </div>
      </section>

      {config ? (
        <AuthGate config={config} pilot={<ReaderWorkspace config={config} />}>
          {(accessToken, signOut) => (
            <>
              <div className="session-bar">
                <span>Sessão autenticada · V2 analisa sem guardar no estoque</span>
                <button type="button" onClick={() => void signOut()}>Sair</button>
              </div>
              <ReaderWorkspace persistence={{ config, accessToken }} />
            </>
          )}
        </AuthGate>
      ) : (
        <ReaderWorkspace />
      )}

      <footer>
        {config ? (
          <><strong>V2 em teste:</strong> revise os dados. Analisar ou exportar uma revisão não cria pallet nem movimenta estoque. O leitor anterior mantém o fluxo operacional.</>
        ) : (
          <><strong>Teste seguro:</strong> a revisão V2 não cria pallet nem altera o estoque.</>
        )}
      </footer>
    </main>
  );
}
