import { fireEvent, render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('identifies the product and presents the camera entry point', async () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Paper Stock Control' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'V2 em validação'
    );
    expect(screen.getByText('Tirar foto completa')).toBeInTheDocument();
    expect(screen.queryByText('Iniciar leitura guiada')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Leitor anterior'));
    expect(await screen.findByText('Iniciar leitura guiada')).toBeInTheDocument();
  });
});
