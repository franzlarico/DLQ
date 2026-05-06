const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const EXCHANGE = 'test.exchange';
const QUEUE = 'test.queue';
const DLQ = 'app.dlq';
const DLQ_EXCHANGE = 'dlx.exchange';

async function setup() {
  let connection;
  let channel;
  try {
    console.log('🔗 Conectando a RabbitMQ...');
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    console.log('\n🗑️  Limpiando infraestructura antigua...');
    try { await channel.deleteQueue(QUEUE); } catch (e) {}
    try { await channel.deleteQueue(DLQ); } catch (e) {}
    try { await channel.deleteExchange(EXCHANGE); } catch (e) {}
    try { await channel.deleteExchange(DLQ_EXCHANGE); } catch (e) {}
    
    console.log('\n📦 Creando infraestructura nueva...');
    
    // DLX Exchange
    await channel.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
    console.log(`✓ Exchange DLX: ${DLQ_EXCHANGE}`);
    
    // DLQ
    await channel.assertQueue(DLQ, { durable: true });
    await channel.bindQueue(DLQ, DLQ_EXCHANGE, '');
    console.log(`✓ DLQ: ${DLQ}`);
    
    // Exchange normal
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    console.log(`✓ Exchange: ${EXCHANGE}`);
    
    // Cola con DLX
    await channel.assertQueue(QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLQ_EXCHANGE
      }
    });
    await channel.bindQueue(QUEUE, EXCHANGE, '');
    console.log(`✓ Queue: ${QUEUE}`);
    
    console.log('\n📤 Publicando 3 mensajes en la DLQ...');
    for (let i = 1; i <= 3; i++) {
      const msg = {
        id: i,
        timestamp: new Date().toISOString(),
        data: `Mensaje de prueba #${i}`
      };
      
      await channel.publish(
        DLQ_EXCHANGE,
        '',
        Buffer.from(JSON.stringify(msg)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: `msg-${i}`
        }
      );
      console.log(`✓ Mensaje ${i} en DLQ`);
    }
    
    console.log('\n✅ ¡CONFIGURACIÓN COMPLETA!');
    console.log('\n📋 Ahora en el navegador:');
    console.log('   1. Recarga F5');
    console.log('   2. Haz clic en "Inspeccionar"');
    console.log('   3. Selecciona un mensaje');
    console.log('   4. En Reencolar:');
    console.log(`      - Cantidad: 1`);
    console.log(`      - Exchange: ${EXCHANGE}`);
    console.log(`      - Routing key: ${QUEUE}`);
    console.log('   5. Haz clic en "Reencolar"');
    console.log('   6. Debe desaparecer del listado ✓');
    
    await channel.close();
    await connection.close();
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

setup();
