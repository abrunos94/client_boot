import crypto from 'node:crypto';

                                            
                                
                                       
                                     
 

                                            
                             
                                 
                        
 

/**
 * Valida o desafio GET inicial da Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`)
 * utilizando comparação em tempo constante.
 */
export function verifyWebhookSubscription(
  params                           ,
  expectedVerifyToken        
)                            {
  if (
    params.mode !== 'subscribe' ||
    !params.verifyToken ||
    !params.challenge ||
    !expectedVerifyToken
  ) {
    return {
      verified: false,
      statusCode: 403,
      body: 'Forbidden: Invalid webhook verification parameters',
    };
  }

  const receivedBuf = Buffer.from(params.verifyToken, 'utf8');
  const expectedBuf = Buffer.from(expectedVerifyToken, 'utf8');

  if (receivedBuf.length !== expectedBuf.length) {
    return {
      verified: false,
      statusCode: 403,
      body: 'Forbidden: Verify token mismatch',
    };
  }

  const isMatch = crypto.timingSafeEqual(receivedBuf, expectedBuf);
  if (!isMatch) {
    return {
      verified: false,
      statusCode: 403,
      body: 'Forbidden: Verify token mismatch',
    };
  }

  return {
    verified: true,
    statusCode: 200,
    body: params.challenge,
  };
}

