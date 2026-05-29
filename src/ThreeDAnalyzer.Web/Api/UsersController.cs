using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/users")]
public class UsersController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<UserDto>>> List()
    {
        var items = await db.Users.OrderBy(u => u.Username).ToListAsync();
        return items.Select(u => u.ToDto()).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create([FromBody] CreateUserRequest request)
    {
        var username = (request.Username ?? "").Trim().ToLowerInvariant();
        var password = (request.Password ?? "").Trim();
        var displayName = (request.DisplayName ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(username))
            return BadRequest("Username is required.");
        if (string.IsNullOrEmpty(password))
            return BadRequest("Password is required.");
        if (string.IsNullOrEmpty(displayName))
            displayName = username;

        if (await db.Users.AnyAsync(u => u.Username.ToLower() == username))
            return BadRequest("Username already exists.");

        var user = new User
        {
            Username = username,
            Password = password,
            DisplayName = displayName,
            CreatedDate = DateOnly.FromDateTime(DateTime.UtcNow),
            Status = status
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, user.ToDto());
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<UserDto>> Update(int id, [FromBody] UpdateUserRequest request)
    {
        var user = await db.Users.FindAsync(id);
        if (user == null) return NotFound();

        var password = (request.Password ?? "").Trim();
        var displayName = (request.DisplayName ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(password))
            return BadRequest("Password is required.");
        if (string.IsNullOrEmpty(displayName))
            return BadRequest("Display name is required.");

        user.Password = password;
        user.DisplayName = displayName;
        user.Status = status;

        await db.SaveChangesAsync();
        return user.ToDto();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var user = await db.Users.FindAsync(id);
        if (user == null) return NotFound();

        var currentUsername = HttpContext.Session.GetString("Username");
        if (!string.IsNullOrEmpty(currentUsername)
            && user.Username.Equals(currentUsername, StringComparison.OrdinalIgnoreCase))
            return BadRequest("You cannot delete your own account while signed in.");

        db.Users.Remove(user);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static string NormalizeStatus(string? status)
    {
        var s = (status ?? "").Trim();
        if (s.Equals("inactive", StringComparison.OrdinalIgnoreCase)
            || s.Equals("INACTIVE", StringComparison.OrdinalIgnoreCase))
            return "INACTIVE";
        return "ACTIVE";
    }
}
