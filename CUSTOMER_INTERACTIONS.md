# Customer Interactions Database Design

## Database Structure

### Core Tables

```sql
-- Customers table stores basic customer information
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_interaction_at TIMESTAMP
);

-- Interactions table tracks all customer interactions
CREATE TABLE interactions (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  channel VARCHAR(50) NOT NULL, -- 'email' or 'chat'
  conversation_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table stores individual messages
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  interaction_id UUID REFERENCES interactions(id),
  direction VARCHAR(50) NOT NULL, -- 'incoming' or 'outgoing'
  content TEXT NOT NULL,
  content_type VARCHAR(50) NOT NULL, -- 'text', 'image', etc.
  processed_content JSONB, -- Stores AI analysis/classification
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attachments table handles files and images
CREATE TABLE attachments (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages(id),
  type VARCHAR(50) NOT NULL,
  url VARCHAR(255),
  analysis JSONB, -- Stores image analysis results
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Context & Analysis Tables
CREATE TABLE context_data (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id),
  interaction_id UUID REFERENCES interactions(id),
  context_type VARCHAR(50) NOT NULL, -- 'appraisal', 'sales', etc.
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_analysis (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages(id),
  classification JSONB NOT NULL,
  sentiment JSONB,
  entities JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Process Structure

### 1. Customer Identification
```javascript
async function identifyCustomer(email, name = null) {
  // Find or create customer record
  let customer = await db.customers.findByEmail(email);
  if (!customer) {
    customer = await db.customers.create({ email, name });
  }
  return customer;
}
```

### 2. Interaction Creation
```javascript
async function createInteraction(customerId, channel, conversationId) {
  return await db.interactions.create({
    customer_id: customerId,
    channel,
    conversation_id: conversationId
  });
}
```

### 3. Message Processing
```javascript
async function processMessage(interactionId, content, direction, contentType) {
  // Create message record
  const message = await db.messages.create({
    interaction_id: interactionId,
    direction,
    content,
    content_type: contentType
  });

  // Process with OpenAI
  const analysis = await analyzeMessage(content);
  
  // Store analysis
  await db.ai_analysis.create({
    message_id: message.id,
    classification: analysis.classification,
    sentiment: analysis.sentiment,
    entities: analysis.entities
  });

  return message;
}
```

### 4. Context Management
```javascript
async function storeContext(customerId, interactionId, contextType, data) {
  return await db.context_data.create({
    customer_id: customerId,
    interaction_id: interactionId,
    context_type: contextType,
    data
  });
}
```

### 5. Integration Flow

#### Email Processing
```javascript
async function handleEmail(email, content) {
  const customer = await identifyCustomer(email.from);
  const interaction = await createInteraction(customer.id, 'email', email.threadId);
  await processMessage(interaction.id, content, 'incoming', 'text');
  // Process attachments if any
  if (email.attachments) {
    await processAttachments(interaction.id, email.attachments);
  }
}
```

#### Chat Processing
```javascript
async function handleChatMessage(clientId, message) {
  const customer = await identifyCustomer(message.email);
  const interaction = await createInteraction(customer.id, 'chat', message.conversationId);
  await processMessage(interaction.id, message.content, 'incoming', 'text');
}
```

### 6. Context Retrieval
```javascript
async function getCustomerContext(customerId) {
  const recentInteractions = await db.interactions.findRecent(customerId);
  const contextData = await db.context_data.findByCustomer(customerId);
  
  return {
    interactions: recentInteractions,
    context: contextData
  };
}
```

## Benefits
- Unified customer history across channels
- Rich context for AI processing
- Efficient querying capabilities
- Scalable data organization
- Flexible analysis storage