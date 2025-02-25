import { ClockFake } from "../__tests__/clockFake";
import { AttributeListType } from "aws-sdk/clients/cognitoidentityserviceprovider";
import {
  newMockDataStore,
  newMockDataStoreFactory,
} from "../__tests__/mockDataStore";
import { TestContext } from "../__tests__/testContext";
import { DataStore } from "./dataStore/dataStore";
import {
  attributesFromRecord,
  attributesInclude,
  attributesIncludeMatch,
  attributesToRecord,
  User,
  UserPoolService,
  UserPoolServiceImpl,
  Group,
  UserPoolServiceFactoryImpl,
} from "./userPoolService";
import * as TDB from "../__tests__/testDataBuilder";

describe("UserPoolServiceFactory", () => {
  it("creates a database", async () => {
    const mockDataStoreFactory = newMockDataStoreFactory(newMockDataStore());

    const clientsDataStore = newMockDataStore();
    const factory = new UserPoolServiceFactoryImpl(
      new ClockFake(new Date()),
      mockDataStoreFactory
    );

    await factory.create(TestContext, clientsDataStore, {
      Id: "local",
      UsernameAttributes: [],
    });

    expect(mockDataStoreFactory.create).toHaveBeenCalledWith(
      TestContext,
      "local",
      {
        Options: { Id: "local", UsernameAttributes: [] },
        Users: {},
      }
    );
  });
});

describe("User Pool Service", () => {
  let mockClientsDataStore: jest.Mocked<DataStore>;
  const currentDate = new Date(2020, 1, 2, 3, 4, 5);

  let clock: ClockFake;

  beforeEach(() => {
    clock = new ClockFake(currentDate);

    mockClientsDataStore = newMockDataStore();
  });

  describe("createAppClient", () => {
    it("saves an app client", async () => {
      const ds = newMockDataStore();
      ds.get.mockImplementation((ctx, key, defaults) =>
        Promise.resolve(defaults)
      );

      const userPool = new UserPoolServiceImpl(
        mockClientsDataStore,
        clock,
        ds,
        {
          Id: "local",
          UsernameAttributes: [],
        }
      );

      const result = await userPool.createAppClient(TestContext, "clientName");

      expect(result).toEqual({
        AllowedOAuthFlowsUserPoolClient: false,
        ClientId: expect.stringMatching(/^[a-z0-9]{25}$/),
        ClientName: "clientName",
        CreationDate: currentDate,
        LastModifiedDate: currentDate,
        RefreshTokenValidity: 30,
        UserPoolId: "local",
      });

      expect(mockClientsDataStore.set).toHaveBeenCalledWith(
        TestContext,
        ["Clients", result.ClientId],
        result
      );
    });
  });

  describe("saveUser", () => {
    const user = TDB.user();

    it("saves the user", async () => {
      const ds = newMockDataStore();

      const userPool = new UserPoolServiceImpl(
        mockClientsDataStore,
        clock,
        ds,
        {
          Id: "local",
          UsernameAttributes: [],
        }
      );

      await userPool.saveUser(TestContext, user);

      expect(ds.set).toHaveBeenCalledWith(
        TestContext,
        ["Users", user.Username],
        user
      );
    });
  });

  describe("deleteUser", () => {
    const user = TDB.user();

    it("deletes the user", async () => {
      const ds = newMockDataStore();

      const userPool = new UserPoolServiceImpl(
        mockClientsDataStore,
        clock,
        ds,
        {
          Id: "local",
          UsernameAttributes: [],
        }
      );

      await userPool.deleteUser(TestContext, user);

      expect(ds.delete).toHaveBeenCalledWith(TestContext, [
        "Users",
        user.Username,
      ]);
    });
  });

  describe("getUserByUsername", () => {
    const user = TDB.user({
      Username: "1",
      Attributes: [
        { Name: "sub", Value: "uuid-1234" },
        { Name: "email", Value: "example@example.com" },
        { Name: "phone_number", Value: "0411000111" },
      ],
    });

    describe.each`
      username_attributes          | find_by_email | find_by_phone_number
      ${[]}                        | ${false}      | ${false}
      ${["email"]}                 | ${true}       | ${false}
      ${["phone_number"]}          | ${false}      | ${true}
      ${["email", "phone_number"]} | ${true}       | ${true}
    `(
      "$username_attributes username attributes",
      ({ username_attributes, find_by_email, find_by_phone_number }) => {
        let userPool: UserPoolService;

        beforeEach(() => {
          const options = {
            Id: "local",
            UsernameAttributes: username_attributes,
          };
          const users: Record<string, User> = {
            [user.Username]: user,
          };

          const ds = newMockDataStore();
          ds.get.mockImplementation((ctx, key) => {
            if (key === "Users") {
              return Promise.resolve(users);
            } else if (key === "Options") {
              return Promise.resolve(options);
            } else if (Array.isArray(key) && key[0] === "Users") {
              return Promise.resolve(users[key[1]]);
            }

            return Promise.resolve(null);
          });

          userPool = new UserPoolServiceImpl(
            mockClientsDataStore,
            clock,
            ds,
            options
          );
        });

        it("returns null if user doesn't exist", async () => {
          const user = await userPool.getUserByUsername(TestContext, "invalid");

          expect(user).toBeNull();
        });

        it("returns existing user by their username", async () => {
          const foundUser = await userPool.getUserByUsername(
            TestContext,
            user.Username
          );

          expect(foundUser).toEqual(user);
        });

        it("returns existing user by their sub", async () => {
          const foundUser = await userPool.getUserByUsername(
            TestContext,
            "uuid-1234"
          );

          expect(foundUser).toEqual(user);
        });

        if (find_by_email) {
          it("returns existing user by their email", async () => {
            const foundUser = await userPool.getUserByUsername(
              TestContext,
              "example@example.com"
            );

            expect(foundUser).toEqual(foundUser);
          });
        } else {
          it("does not return the user by their email", async () => {
            const foundUser = await userPool.getUserByUsername(
              TestContext,
              "example@example.com"
            );

            expect(foundUser).toBeNull();
          });
        }

        if (find_by_phone_number) {
          it("returns existing user by their phone number", async () => {
            const foundUser = await userPool.getUserByUsername(
              TestContext,
              "0411000111"
            );

            expect(foundUser).toEqual(user);
          });
        } else {
          it("does not return the user by their phone number", async () => {
            const foundUser = await userPool.getUserByUsername(
              TestContext,
              "0411000111"
            );

            expect(foundUser).toBeNull();
          });
        }
      }
    );
  });

  describe("listUsers", () => {
    const user1 = TDB.user({
      Username: "1",
    });
    const user2 = TDB.user({
      Username: "2",
    });

    let userPool: UserPoolService;

    beforeEach(() => {
      const options = {
        Id: "local",
      };

      const users = {
        [user1.Username]: user1,
        [user2.Username]: user2,
      };

      const ds = newMockDataStore();
      ds.get.mockImplementation((ctx, key) => {
        if (key === "Users") {
          return Promise.resolve(users);
        } else if (key === "Options") {
          return Promise.resolve(options);
        }

        return Promise.resolve(null);
      });
      userPool = new UserPoolServiceImpl(mockClientsDataStore, clock, ds, {
        Id: "local",
        UsernameAttributes: [],
      });
    });

    it("returns existing users", async () => {
      const users = await userPool.listUsers(TestContext);

      expect(users).not.toBeNull();
      expect(users).toEqual([user1, user2]);
    });
  });

  describe("attributes", () => {
    const attributes: AttributeListType = [
      { Name: "sub", Value: "uuid" },
      { Name: "email", Value: "example@example.com" },
    ];

    describe("attributesIncludeMatch", () => {
      it("returns true if attribute exists in collection with matching name and value", () => {
        expect(
          attributesIncludeMatch("email", "example@example.com", attributes)
        ).toBe(true);
      });

      it("returns false if attribute exists in collection with matching name but not matching value", () => {
        expect(attributesIncludeMatch("email", "invalid", attributes)).toBe(
          false
        );
      });

      it("returns false if attribute does not exist in collection", () => {
        expect(attributesIncludeMatch("invalid", "invalid", attributes)).toBe(
          false
        );
      });
    });

    describe("attributesInclude", () => {
      it("returns true if attribute exists in collection with matching name", () => {
        expect(attributesInclude("email", attributes)).toBe(true);
      });

      it("returns false if attribute does not exist in collection", () => {
        expect(attributesInclude("invalid", attributes)).toBe(false);
      });
    });

    describe("attributesToRecord", () => {
      it("converts the attributes to a record", () => {
        expect(attributesToRecord(attributes)).toEqual({
          sub: "uuid",
          email: "example@example.com",
        });
      });
    });

    describe("attributesFromRecord", () => {
      it("converts the attributes to a record", () => {
        expect(
          attributesFromRecord({
            sub: "uuid",
            email: "example@example.com",
          })
        ).toEqual(attributes);
      });
    });
  });

  describe("saveGroup", () => {
    it("saves the group", async () => {
      const now = new Date();
      const ds = newMockDataStore();

      const userPool = new UserPoolServiceImpl(
        mockClientsDataStore,
        clock,
        ds,
        {
          Id: "local",
          UsernameAttributes: [],
        }
      );

      await userPool.saveGroup(TestContext, {
        CreationDate: now,
        Description: "Description",
        GroupName: "theGroupName",
        LastModifiedDate: now,
        Precedence: 1,
        RoleArn: "ARN",
      });

      expect(ds.set).toHaveBeenCalledWith(
        TestContext,
        ["Groups", "theGroupName"],
        {
          CreationDate: now,
          Description: "Description",
          GroupName: "theGroupName",
          LastModifiedDate: now,
          Precedence: 1,
          RoleArn: "ARN",
        }
      );
    });
  });

  describe("listGroups", () => {
    let userPool: UserPoolService;

    beforeEach(() => {
      const options = {
        Id: "local",
      };
      const groups: Record<string, Group> = {
        theGroupName: {
          CreationDate: new Date(),
          Description: "Description",
          GroupName: "theGroupName",
          LastModifiedDate: new Date(),
          Precedence: 1,
          RoleArn: "ARN",
        },
      };

      const ds = newMockDataStore();
      ds.get.mockImplementation((ctx, key) => {
        if (key === "Groups") {
          return Promise.resolve(groups);
        } else if (key === "Options") {
          return Promise.resolve(options);
        }

        return Promise.resolve(null);
      });
      userPool = new UserPoolServiceImpl(
        mockClientsDataStore,
        clock,
        ds,
        options
      );
    });

    it("returns existing groups", async () => {
      const groups = await userPool.listGroups(TestContext);

      expect(groups).not.toBeNull();
      expect(groups).toHaveLength(1);
      expect(groups[0].GroupName).toEqual("theGroupName");
    });
  });
});
