import { render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('identifies the product and presents the camera entry point', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Paper Stock Control' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'O vídeo não é gravado'
    );
    expect(screen.getByText('Iniciar leitura guiada')).toBeInTheDocument();
  });
});
