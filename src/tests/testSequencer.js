const Sequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends Sequencer {
  sort(tests) {
    // Sort tests to run unit tests before integration tests
    const unitTests = tests.filter(test => 
      !test.path.includes('integration.test.ts')
    );
    const integrationTests = tests.filter(test => 
      test.path.includes('integration.test.ts')
    );
    
    return [...unitTests, ...integrationTests];
  }
}

module.exports = CustomSequencer;
