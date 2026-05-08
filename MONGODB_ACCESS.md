# Acceso a MongoDB - Auditoría DLQ

## 📊 Información de Conexión

```
URL: mongodb://admin:admin123@localhost:27017/dlq-console?authSource=admin
Base de Datos: dlq-console
Colección Principal: audit_logs
```

## 🔧 Método 1: MongoDB Compass (Interfaz Gráfica) - RECOMENDADO

### Instalación
1. Descargar desde: https://www.mongodb.com/products/tools/compass
2. Instalar y ejecutar

### Conexión
1. Abre MongoDB Compass
2. En el campo "URI" pega:
   ```
   mongodb://admin:admin123@localhost:27017/dlq-console?authSource=admin
   ```
3. Click en "Connect"

### Exploración de Datos
```
Izquierda → dlq-console (Base de datos)
            ├── audit_logs (Colección con todos los registros)
            └── Otras colecciones si existen
```

### Ver todos los registros de auditoría
1. Click en **audit_logs**
2. Verás todos los documentos guardados
3. Cada documento contiene:
   - `_id` - ID único del registro
   - `eventType` - Tipo de evento (REQUEUE, INSPECT, etc.)
   - `sourceQueue` - Cola de origen
   - `targetExchange` - Exchange destino
   - `targetRoutingKey` - Routing key destino
   - `messageCount` - Total de mensajes procesados
   - `successCount` - Mensajes reencolados exitosamente
   - `status` - SUCCESS / PARTIAL / FAILED
   - `duration` - Tiempo en millisegundos
   - `arrivedAtDlqTime` - Cuándo llegó a la DLQ
   - `errorMessage` - Mensaje de error (si aplica)
   - `createdAt` - Cuándo se creó este registro
   - `updatedAt` - Última actualización

### Filtrar por rango de fechas
En la sección "Filter", agrega:
```json
{
  "createdAt": {
    "$gte": ISODate("2024-01-10T00:00:00Z"),
    "$lte": ISODate("2024-01-11T23:59:59Z")
  }
}
```

### Ver registros fallidos
```json
{
  "status": "FAILED"
}
```

### Ver registros de una cola específica
```json
{
  "sourceQueue": "tu.cola.aqui"
}
```

---

## 💻 Método 2: Línea de Comandos

### 1. Conectar a MongoDB
```bash
mongosh "mongodb://admin:admin123@localhost:27017/dlq-console?authSource=admin"
```

### 2. Ver todos los registros
```javascript
db.audit_logs.find().pretty()
```

### 3. Contar registros totales
```javascript
db.audit_logs.countDocuments()
```

### 4. Ver últimos 10 registros (más recientes primero)
```javascript
db.audit_logs.find().sort({ createdAt: -1 }).limit(10).pretty()
```

### 5. Ver registros exitosos
```javascript
db.audit_logs.find({ status: "SUCCESS" }).pretty()
```

### 6. Ver registros fallidos
```javascript
db.audit_logs.find({ status: "FAILED" }).pretty()
```

### 7. Contar por estado
```javascript
db.audit_logs.aggregate([
  {
    $group: {
      _id: "$status",
      count: { $sum: 1 }
    }
  }
])
```

### 8. Ver registros de una cola específica
```javascript
db.audit_logs.find({ sourceQueue: "nombre.de.tu.cola" }).pretty()
```

### 9. Ver mensajes procesados por cola (últimos 7 días)
```javascript
db.audit_logs.aggregate([
  {
    $match: {
      createdAt: {
        $gte: new Date(Date.now() - 7*24*60*60*1000)
      }
    }
  },
  {
    $group: {
      _id: "$sourceQueue",
      totalMessages: { $sum: "$messageCount" },
      successMessages: { $sum: "$successCount" },
      operations: { $sum: 1 }
    }
  },
  {
    $sort: { totalMessages: -1 }
  }
])
```

### 10. Ver duración promedio de requeues
```javascript
db.audit_logs.aggregate([
  {
    $match: {
      eventType: "REQUEUE",
      status: "SUCCESS"
    }
  },
  {
    $group: {
      _id: "$sourceQueue",
      avgDuration: { $avg: "$duration" },
      totalRequeues: { $sum: "$successCount" }
    }
  }
])
```

### 11. Exportar datos a JSON
```bash
mongoexport \
  --uri "mongodb://admin:admin123@localhost:27017/dlq-console?authSource=admin" \
  --collection audit_logs \
  --out audit_logs_backup.json
```

### 12. Salir
```javascript
exit()
```

---

## 📈 Ejemplo de Flujo Completo en Compass

### Auditar un requeue específico:
1. **Conectar** a MongoDB con la URI
2. **Expandir** base de datos `dlq-console`
3. **Click en** `audit_logs`
4. **Filter** (si deseas):
   ```json
   {
     "sourceQueue": "mi.cola.dlq",
     "createdAt": { "$gte": ISODate("2024-01-10T12:00:00Z") }
   }
   ```
5. **Ver documentos** - Haz scroll para ver todos los campos
6. **Click en un documento** para ver todos los detalles en formato expandido

---

## 🔍 Información Importante

### ¿Cuándo se guardan los registros?
- **Al reencolar** mensajes exitosamente
- **Si falla** el reencolado
- **Operaciones parciales** (algunos éxito, algunos fallo)

### ¿Qué timestamp me dice cuándo falló?
- **`arrivedAtDlqTime`**: Cuándo llegó a la DLQ (desde x-death header de RabbitMQ)
- **`createdAt`**: Cuándo se grabó este registro de auditoría
- El diferencial entre `createdAt` y `arrivedAtDlqTime` te dice cuánto tiempo estuvo en la DLQ antes del requeue

### Ejemplo de registro auditable:
```json
{
  "_id": ObjectId("..."),
  "eventType": "REQUEUE",
  "sourceQueue": "payments.dlq",
  "targetExchange": "payments.exchange",
  "targetRoutingKey": "payment.process",
  "messageCount": 5,
  "successCount": 5,
  "status": "SUCCESS",
  "duration": 1234,
  "arrivedAtDlqTime": ISODate("2024-01-10T14:30:00Z"),
  "createdAt": ISODate("2024-01-10T14:35:22Z"),
  "updatedAt": ISODate("2024-01-10T14:35:22Z")
}
```

---

## 📋 Monitoreo Recomendado

### Diario: Ver resumen del día
```javascript
const today = new Date();
today.setHours(0, 0, 0, 0);

db.audit_logs.aggregate([
  {
    $match: { createdAt: { $gte: today } }
  },
  {
    $group: {
      _id: "$status",
      count: { $sum: 1 },
      totalMsgs: { $sum: "$messageCount" },
      successMsgs: { $sum: "$successCount" }
    }
  }
])
```

### Por Cola: Qué colas tienen más problemas
```javascript
db.audit_logs.aggregate([
  {
    $match: { status: { $ne: "SUCCESS" } }
  },
  {
    $group: {
      _id: "$sourceQueue",
      failures: { $sum: 1 },
      errorTypes: { $addToSet: "$errorMessage" }
    }
  },
  {
    $sort: { failures: -1 }
  }
])
```

---

## ⚠️ Notas Importantes

- Los timestamps en MongoDB están en UTC (Hora Universal)
- El campo `duration` está en **milisegundos**
- Todos los registros tienen `eventType: "REQUEUE"` actualmente (para auditoría)
- Los índices están optimizados para búsquedas por fecha, cola y estado

## 🆘 Troubleshooting

**No puedo conectar a MongoDB:**
- Verifica que MongoDB está ejecutándose: `mongo --version`
- Verifica las credenciales: usuario `admin`, contraseña `admin123`
- Verifica el host y puerto: `localhost:27017`

**No veo datos en audit_logs:**
- Los datos solo aparecen DESPUÉS de hacer un requeue exitoso
- Verifica el backend esté grabando: mira los logs del backend

**Valores nulos en campos:**
- `targetExchange`, `targetRoutingKey`: Pueden ser inferidos
- `errorMessage`: Solo existe si `status !== SUCCESS`

