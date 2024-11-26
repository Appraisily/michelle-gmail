# Image Processing in Michelle Gmail

## Overview
The system uses OpenAI's GPT-4V (Vision) capabilities to analyze images attached to customer emails. This enables quick preliminary assessments of art and antique items before formal appraisal.

## Implementation Details

### Models Used
- Classification: `gpt-4o-mini` - Quick, accurate email and image classification
- Response Generation: `gpt-4o` - Natural language response generation

### Image Processing Flow
1. Email received with attachments
2. Images extracted and converted to base64
3. Images included in classification prompt
4. GPT-4V analyzes both text and images
5. Response generated based on combined analysis

### Supported Image Types
```javascript
const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic'
];
```

### Image Processing Functions
- `extractImageAttachments`: Identifies image attachments in email
- `downloadAttachment`: Retrieves image data from Gmail
- `processImageAttachments`: Processes all images in an email
- `formatImageAttachments`: Prepares images for OpenAI API

## Usage Example
```javascript
const messages = [
  {
    role: "user",
    content: [
      { 
        type: "text", 
        text: "Analyze this email and attached images" 
      },
      {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${imageData}`
        }
      }
    ]
  }
];
```

## Future Enhancements
1. Image preprocessing and optimization
2. Multiple model comparison for accuracy
3. Automated value range estimation
4. Historical price comparison
5. Similar item matching