import { render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('identifies the product and presents the camera entry point', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Paper Stock Control' })
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'A foto não sai do aparelho neste teste'
    );
    expect(screen.getByText('Abrir câmera')).toBeInTheDocument();
  });
});
