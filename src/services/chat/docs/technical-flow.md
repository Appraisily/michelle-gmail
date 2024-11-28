# Chat System Technical Flow

## Client Initialization

1. User opens chat widget
2. Store initialized with Zustand
3. Client ID retrieved/generated using IndexedDB
4. Previous messages loaded from IndexedDB
5. WebSocket connection initiated

## Connection Establishment

### Connect Message
```json
{
  "type": "connect",
  "clientId": "string",
  "timestamp": "string"
}
```

### Server Confirmation
```json
{
  "type": "connect_confirm",
  "conversationId": "string",
  "timestamp": "string"
}
```

### Heartbeat (10s interval)
```json
{
  "type": "ping",
  "clientId": "string",
  "timestamp": "string"
}
```

## Message Flow

### 1. Message Sending
- User composes message
- Client generates UUID for messageId
- Client sends:
```json
{
  "type": "message",
  "content": "string",
  "images?": "ImageData[]",
  "timestamp": "string",
  "messageId": "string",
  "clientId": "string"
}
```
- UI updates to "sent" state (✓)

### 2. Server Confirmation
```json
{
  "type": "confirm",
  "messageId": "string",
  "timestamp": "string"
}
```
- UI updates to "received" state (✓✓)

### 3. Server Response
```json
{
  "type": "response",
  "messageId": "string",
  "replyTo": "string",
  "content": "string",
  "timestamp": "string"
}
```
- UI updates to "processed" state (✓✓ blue)

## Image Processing

### 1. Image Selection
- User selects image
- Client validates size/format
- Base64 conversion
- Message sent with images:
```json
{
  "type": "message",
  "content?": "string",
  "images": [{
    "id": "string",
    "data": "string",
    "mimeType": "string",
    "filename?": "string"
  }],
  "timestamp": "string",
  "messageId": "string",
  "clientId": "string"
}
```

### 2. Image Status Updates
```json
{
  "type": "confirm",
  "messageId": "string",
  "imageId": "string",
  "status": "received" | "processing" | "analyzed",
  "timestamp": "string"
}
```

### 3. Analysis Response
```json
{
  "type": "response",
  "messageId": "string",
  "replyTo": "string",
  "content": "string",
  "imageAnalysis": [{
    "imageId": "string",
    "description": "string",
    "category": "string",
    "condition": "string",
    "features": "string[]",
    "recommendations": "string[]"
  }],
  "timestamp": "string"
}
```

## Error Handling

### Error Messages
```json
{
  "type": "error",
  "error": "string",
  "timestamp": "string"
}
```

### Reconnection Strategy
- Maximum 3 attempts
- Exponential backoff (5s, 10s, 20s)
- Minimum 5s between attempts

## Data Persistence

- Messages: IndexedDB
- Client ID: localStorage
- Chat State: Zustand store

## Session Termination

### Disconnect Message
```json
{
  "type": "disconnect",
  "clientId": "string",
  "timestamp": "string"
}
```

### Cleanup
1. Clear intervals
2. Clear references
3. Close WebSocket
4. Persist state for next session

## Implementation Features

- Bidirectional state management
- Message delivery confirmation
- Image analysis pipeline
- Data persistence strategy
- Smart reconnection handling
- Error management
- Synchronized UI states