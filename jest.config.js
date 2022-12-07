/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  clearMocks: true,
  preset: "ts-jest",
  resetMocks: true,
  resetModules: true,
  restoreMocks: true,
  showSeed: true,
  testEnvironment: "jsdom",
};
