# Agora Famille

Esta integración conecta Gladys con el **portal familiar Agora Famille**
(editado por Agora Plus) de su municipio francés: comedor escolar,
actividades antes y después de clase, centros de ocio, facturas y mensajes
del ayuntamiento.

Lee el portal como lo haría su navegador, con su propia cuenta, y le ofrece
en Gladys:

- un dispositivo **por niño**: lo reservado hoy y mañana, y si come en el
  comedor;
- un dispositivo **cuenta familiar**: el saldo pendiente, la próxima factura,
  el último mensaje;
- **disparadores de escena** (nueva factura, factura a punto de vencer, nuevo
  mensaje, reserva aceptada o rechazada);
- **acciones de escena** (declarar una ausencia, reservar una comida,
  comprobar un día, volver a leer el portal);
- un **widget** del panel.

## Antes de empezar

- Se necesita **Gladys 5.3 o posterior**.
- Necesita una cuenta **activa** en el portal Agora Famille de su municipio:
  el correo y la contraseña con los que inicia sesión.
- La integración es de tipo **cloud**: necesita internet para llegar al
  portal.

## Configuración

En Gladys: **Integraciones → Agora Famille → Configuración**.

| Campo                              | Qué poner                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Dirección del portal**           | La dirección de su portal tal como la muestra su navegador, p. ej. `https://portalssl.agoraplus.fr/miciudad/pck_home.home_view#/`. Basta también con el nombre del municipio (`miciudad`). |
| **Usuario (correo)**               | El correo de su cuenta familiar.                                                                                                                                                           |
| **Contraseña**                     | La contraseña del portal. Gladys la guarda como secreto y nunca aparece en los registros.                                                                                                  |
| **Intervalo de lectura (min)**     | Cada cuánto se lee el portal (60 min por defecto, 15 min como mínimo).                                                                                                                     |
| **Días de planificación seguidos** | Cuántos días por adelantado se leen y vigilan (14 por defecto).                                                                                                                            |
| **Aviso de factura (días)**        | El disparador «factura a punto de vencer» se activa estos días antes del vencimiento (3 por defecto, 0 lo desactiva).                                                                      |
| **Registros detallados**           | Registra cada petición al portal, para diagnosticar. Nunca la contraseña.                                                                                                                  |

Pulse después **Probar la conexión**: la respuesta indica sus hijos, el
número de días de planificación leídos, las facturas por pagar y los mensajes
sin leer. Si falla, dice qué paso falló (inicio de sesión, hijos,
planificación, facturas, mensajes).

Abra luego la pestaña **Descubrir** para crear los dispositivos.

## Dispositivos

### Agora Famille (la cuenta)

| Función          | Contenido                                                        |
| ---------------- | ---------------------------------------------------------------- |
| **Balance due**  | Lo que queda por pagar, en euros (todas las facturas impagadas). |
| **Next invoice** | La próxima factura por pagar: importe, vencimiento, concepto.    |
| **Last message** | El asunto del último mensaje del municipio.                      |

### Un dispositivo por niño

| Función              | Contenido                                                     |
| -------------------- | ------------------------------------------------------------- |
| **Today**            | Las actividades reservadas hoy («Cantine, Garderie du soir»). |
| **Tomorrow**         | Las actividades reservadas mañana.                            |
| **Canteen today**    | 1 si el niño come hoy en el comedor, 0 si no.                 |
| **Canteen tomorrow** | 1 si el niño come mañana en el comedor, 0 si no.              |

Un día **solicitado** y aún no validado por el municipio cuenta como
reservado. Los textos están en francés, como las actividades del portal.

La comida se reconoce por su nombre: «cantine», «repas», «restauration»,
«déjeuner», «pause méridienne»… Cada municipio nombra sus actividades a su
manera.

La insignia **cloud** de cada dispositivo pasa a **inaccesible** mientras no
se puede leer el portal.

## Escenas (Gladys 5.1+)

### Disparadores

| Disparador                     | Cuándo                                                                                                             | Variables                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Se emite una nueva factura** | Aparece una factura impagada.                                                                                      | `label`, `amount`, `due_date`, `invoice_id`                           |
| **Una factura vence pronto**   | Una factura impagada vence dentro de los días fijados. Una sola vez.                                               | `label`, `amount`, `due_date`, `days_left`, `invoice_id`              |
| **Se recibe un mensaje**       | El municipio envió un mensaje.                                                                                     | `subject`, `sender`, `date`                                           |
| **Una reserva cambia**         | Un día reservado o solicitado cambia de estado (aceptado, rechazado, cancelado…). Filtrable por niño y por estado. | `child_name`, `activity`, `date`, `status`, `previous_status`, `meal` |

Las variables se usan en las acciones siguientes, p. ej.
`{{triggerEvent.data.amount}}`.

La primera lectura del portal no dispara nada: todo parecería nuevo. Los
cambios se cuentan a partir de ahí, también tras un reinicio (la integración
guarda la última lectura en `/data`).

### Acciones

| Acción                              | Qué hace                                                                                            | Salidas                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Leer el portal familiar**         | Lee el portal ahora mismo.                                                                          | `success`, `balance`, `unpaid_invoices`, `unread_messages` |
| **Comprobar el día de un niño**     | Si el niño está reservado ese día (0 = hoy, 1 = mañana…) y para qué.                                | `has_meal`, `booked_count`, `activities`, `date`           |
| **Declarar la ausencia de un niño** | Pide cancelar las actividades reservadas de un día. Actividad vacía = todas; «comedor» = la comida. | `requested_count`, `activities`, `date`                    |
| **Reservar un día para un niño**    | Solicita un día de una actividad en la que el niño está inscrito (el comedor por defecto).          | `requested`, `already_booked`, `activity`, `date`          |

Las solicitudes pasan por el portal: el municipio las valida según sus
propios plazos. El disparador «una reserva cambia» le avisa de su respuesta.

### Ejemplos

- **Cada tarde a las 19 h**: _Comprobar el día_ de cada niño para mañana y,
  si `has_meal` es falso, enviar «Mañana Léa no tiene comedor».
- **Una factura vence pronto** → enviar «Factura de
  {{triggerEvent.data.amount}} € a pagar antes del
  {{triggerEvent.data.due_date}}».
- **Una reserva cambia**, filtrado en _Rechazado_ → notificación.
- Un botón «Niño enfermo» → _Declarar la ausencia_ para hoy.

## El widget

El widget **Agora Famille** del panel muestra:

- el saldo pendiente (en directo);
- para cada niño (5 como máximo), lo reservado hoy y mañana (verde:
  reservado, naranja: solicitud pendiente, rojo: rechazado);
- las facturas por pagar y los mensajes sin leer;
- la hora de la última lectura, o el error actual.

Y cuatro botones: **Actualizar**, **Ausencia** y **Reservar comida** (un
breve formulario pide el niño y el día), **Abrir portal**.

## Solución de problemas

- **«El portal rechazó el usuario o la contraseña»**: compruébelos iniciando
  sesión en el portal desde un navegador. Una cuenta pendiente de validación
  por el ayuntamiento aún no puede iniciar sesión.
- **«El portal no responde»**: puede que el portal esté en mantenimiento; la
  integración lo vuelve a intentar en cada intervalo.
- **«El portal respondió algo inesperado»**: marque **Registros
  detallados**, pulse **Probar la conexión** y consulte los registros de la
  integración (Integraciones → Agora Famille → Supervisión).

### Importante: no hay API oficial

Agora Plus no publica ninguna API para su portal familiar. La integración
hace las mismas peticiones que las páginas del portal; están reunidas en un
único archivo, [`src/agora/endpoints.js`](../src/agora/endpoints.js). Una
actualización del portal, o un municipio configurado de otra forma, puede
requerir ajustarlas: abra entonces una
[incidencia](https://github.com/prohand/gladys-agorafamille/issues) indicando
el paso que falla y el código HTTP devuelto (nunca su contraseña).

## Privacidad

- Las credenciales solo sirven para iniciar sesión en el portal de su
  municipio, por HTTPS.
- La contraseña y las cookies de sesión nunca se escriben en los registros.
- La última lectura del portal (planificación, facturas, mensajes) se guarda
  en el volumen privado `/data` de la integración, para detectar cambios tras
  un reinicio. No se envía nada a ningún otro sitio.
