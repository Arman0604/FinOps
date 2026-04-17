export const spendForecastData = [
  { name: 'Mon', actual: 4000, predicted: 4200 },
  { name: 'Tue', actual: 3000, predicted: 3200 },
  { name: 'Wed', actual: 2000, predicted: 2400 },
  { name: 'Thu', actual: 2780, predicted: 2900 },
  { name: 'Fri', actual: 1890, predicted: 2100 },
  { name: 'Sat', actual: 2390, predicted: 2500 },
  { name: 'Sun', actual: 3490, predicted: 3600 },
];

export const monthlySpendData = [
  { name: 'Jul 01', actual: 1.1, predicted: 1.1 },
  { name: 'Jul 07', actual: 1.15, predicted: 1.18 },
  { name: 'Jul 14', actual: 1.25, predicted: 1.2 },
  { name: 'Jul 21', actual: 1.28, predicted: 1.25 },
  { name: 'Jul 28', actual: null, predicted: 1.35 },
  { name: 'Aug 04', actual: null, predicted: 1.42 },
];

export const departmentBudgetData = [
  { name: 'Data Science', budget: 150000, actual: 180000 },
  { name: 'Cloud Infra', budget: 500000, actual: 420000 },
  { name: 'Marketing', budget: 60000, actual: 45000 },
];

export const providerData = [
  { name: 'AWS', value: 62, fill: '#06B6D4' },
  { name: 'Azure', value: 24, fill: '#3B82F6' },
  { name: 'GCP', value: 14, fill: '#8B5CF6' },
];

export const utilizationData = [
  { utilization: 80, cost: 2.1, status: 'optimized' },
  { utilization: 85, cost: 1.8, status: 'optimized' },
  { utilization: 30, cost: 4.5, status: 'waste' },
  { utilization: 25, cost: 3.8, status: 'waste' },
  { utilization: 92, cost: 1.5, status: 'optimized' },
  { utilization: 40, cost: 2.9, status: 'warning' },
];

export const summaryMetrics = {
  totalSpend: {
    value: "$1,248,302",
    trend: "+12.4% vs prev. month"
  },
  savings: {
    value: "$242,500",
    active: 14
  },
  anomalies: {
    count: 3,
    severity: "High severity detected in US-East-1"
  }
};
