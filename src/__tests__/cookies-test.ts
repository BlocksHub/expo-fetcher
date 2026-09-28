import { cookies } from '../cookies';

describe('cookies', () => {
  it('serializes cookie objects', async () => {
    await cookies.set('https://api.test', { name: 'sid', value: 'x', secure: true, maxAge: 60, sameSite: 'Lax' });
    const [cookie] = await cookies.get('https://api.test');
    expect(cookie).toMatchObject({ name: 'sid', value: 'x' });
    await cookies.clear();
    expect(await cookies.get('https://api.test')).toEqual([]);
  });
});
