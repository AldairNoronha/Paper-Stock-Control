# ADR-008 — Pipeline de leitura de etiquetas

**Status:** revisado em 2026-09-30

A captura principal passa a ser uma sessão de câmera contínua. QR/barcode permanece
ativo durante toda a sessão. Em paralelo, quadros estáveis da região central são enviados
sequencialmente para um único worker OCR reutilizado.

As leituras são acumuladas por campo. QR e barcode válidos podem ser aceitos em uma
observação; OCR precisa repetir o mesmo valor em pelo menos dois quadros. Um valor de
menor confiança não substitui silenciosamente um valor já aceito.

O aplicativo recomenda a próxima região da etiqueta, mas aceita os campos em qualquer
ordem. Somente os melhores recortes associados aos campos aceitos são persistidos; o
vídeo não é gravado. A análise continua sendo uma proposta revisável e jamais lança
estoque automaticamente.

A fotografia única permanece disponível somente como fallback para navegadores sem
`getUserMedia` ou quando a permissão de câmera for negada.
