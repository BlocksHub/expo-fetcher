jest.mock('expo', () => ({
  requireNativeModule: () => require('./fakeNative').fakeModule,
}));

beforeEach(() => {
  require('./fakeNative').reset();
  require('../session').resetSessions();
});
