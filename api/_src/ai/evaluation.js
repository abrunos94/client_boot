                                     
                                 
                                  
                                
                             
                                        
                                         
                                  
                                    
 

const metricsHistory                       = [];

export const aiEvaluation = {
  recordMetric(metric                    )       {
    metricsHistory.push(metric);
    if (metricsHistory.length > 200) {
      metricsHistory.shift();
    }
  },

  getMetrics()                                {
    return [...metricsHistory];
  },

  clearMetrics()       {
    metricsHistory.length = 0;
  },
};

