

export const fetchHello = async () => {
  console.log('starting fetch of data...');
  const res = await fetch('/ping');
  const data = await res.json();
  console.log('final data is: ', data);
  return data;
}