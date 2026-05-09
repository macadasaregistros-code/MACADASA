# Decision Pendiente: App Pollos de Engorde

`DB:AppPollo` esta compartido y detectado, pero queda inactivo en la sincronizacion actual.

Recomendacion tecnica:

- Si la operacion de pollo todavia no esta estabilizada, conviene crear la nueva app directamente sobre Supabase y MACADASA, no repetir el patron AppSheet + Google Sheets.
- Si el equipo necesita capturar datos operativos muy rapido antes de que MACADASA este listo, AppSheet puede seguir siendo una solucion temporal, pero debe nacer con IDs estables y tablas pensadas para migrar.

Tablas esperadas para pollo:

- granjas
- galpones
- lotes de engorde
- recepcion de aves
- consumo diario de alimento
- mortalidad
- pesos
- medicamentos/vacunas
- salidas a sacrificio
- costos por lote

Criterio recomendado:

Crear el modulo de pollo en Supabase cuando se disene la app MACADASA, porque ahi ya podremos relacionarlo con inventarios, compras, costos, proveedores, ventas y gerencia desde el inicio.
