const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URLE || 'amqp://user:password@localhost:5672';
const DLQ = 'app.dlq';
const DLQ_EXCHANGE = 'dlx.exchange';

async function setupRabbitMQ() {
  let connection;
  let channel;
  try {
    console.log('🔗 Conectando a RabbitMQ:', RABBITMQ_AMQ);
    connection = await amqp.connect(RABBITMQ_AMQ);
    channel = await connection.createChannel();
    
    console.log('\n📦 Creando DLX y DLQ...');
    
    // DLX Exchange
    await channel.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
    console.log(`✓ Exchange creado: ${DLQ_EXCHANGE}`);
    
    // DLQ
    await channel.assertQueue(DLQ, { durable: true });
    await channel.bindQueue(DLQ, DLQ_EXCHANGE, '');
    console.log(`✓ DLQ creada: ${DLQ}`);
    
    console.log('\n📤 Publicando 3 mensajes DIRECTAMENTE en la DLQ...');
    
    for (let i = 1; i <= 3; i++) {
      const msg = {
        id: i,
        timestamp: new Date().toISOString(),
        data: `Mensaje de prueba #${i}`,
        status: 'error'
      };
      
      await channel.publish(
        DLQ_EXCHANGE,
        '',
        Buffer.from(JSON.stringify(msg)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: `msg-${i}`,
          headers: {
            'x-death': JSON.stringify([{
              count: 1,
              reason: 'rejected',
              'queue': 'test.queue',
              'time': new Date().getTime(),
              exchange: 'test.exchange',
              'routing-keys': ['test.queue']
            }])
          }
        }
      );
      console.log(`✓ Mensaje ${i} en DLQ`);
    }
    
    console.log('\n⏳ Esperando 1 segundo...');
    await new Promise(r => setTimeout(r, 1000));
    
    const info = await channel.checkQueue(DLQ);
    console.log(`\n✅ Mensajes en DLQ: ${info.messageCount}/3`);
    
    console.log('\n🚀 Ahora abre el navegador:');
    console.log('   URL: http://localhost:5173');
    console.log(`   Cola: ${DLQ}`);
    console.log('   Haz clic en "Inspeccionar"');
    console.log('   Deberías ver 3 mensajes ✓');
    console.log('\n   Selecciona un mensaje');
    console.log('   En "Reencolar" configura:');
    console.log('     - Cantidad: 1');
    console.log('     - Exchange: test.exchange');
    console.log('     - Routing key: test.queue');
    console.log('   Haz clic en "Reencolar"');
    console.log('\n   Inspecciona de nuevo');
    console.log('   Debe quedar 1 mensaje menos ✓');
    
    await channel.close();
    await connection.close();
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

setupRabbitMQ();