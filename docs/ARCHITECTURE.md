# Arquitectura

## Fronteras

- **Chopify** conserva procesos, estado, reglas, atribución, billing, automatización y auditoría.
- **GanoBot** será un cliente de los puertos de aplicación. Conversa y razona, pero no decide precios, dinero, inventario, permisos ni estados.
- **E-commerce del tenant** seguirá siendo la fuente de catálogo, precio, inventario y operación propia. Los adapters futuros traducirán esos contratos.

## Capas

`UI → application/use cases → domain → repository interfaces → adapters`

- `domain/`: modelos y reglas puras, sin React ni SDKs.
- `application/`: orquestación y puertos consumibles por UI o GanoBot.
- `repositories/`: contratos de persistencia.
- `adapters/`: implementaciones reemplazables; hoy solo SAMPLE en memoria.
- `features/` y `components/`: experiencia Super Admin.
- `stores/`: estado efímero de interfaz.

Toda entidad comercial incluye `tenantId`. Los repositorios reciben el tenant explícitamente para evitar lecturas cruzadas. Dinero usa cents enteros; tasas usan basis points.
